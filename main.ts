import { readAll } from "https://deno.land/std@0.106.0/io/mod.ts";
import * as path from "https://deno.land/std@0.106.0/path/mod.ts";
import { config } from "https://deno.land/x/dotenv@v3.0.0/mod.ts";
import { Client } from "https://deno.land/x/notion_sdk@v0.3.1/src/mod.ts";
import {
  DOMParser,
  Element,
} from "https://deno.land/x/deno_dom@v0.1.13-alpha/deno-dom-wasm.ts";

const RESUME_FROM = 2938;

interface Bookmark {
  title: string;
  url: string;
  date: Date;
  tags: string[];
  memo: string;
}

interface UrlDictionary {
  [url: string]: Bookmark;
}

async function main() {
  const htmlStr = await loadHtml();
  const bookmarks = createBookmarks(htmlStr);
  await insertBookmarks(bookmarks);
  Deno.exit();
}

async function loadHtml(): Promise<string> {
  const filepath = path.join(Deno.cwd(), "GoogleBookmarks.html");
  const file = await Deno.open(filepath);
  const htmlStr = new TextDecoder("utf-8").decode(await readAll(file));
  Deno.close(file.rid);
  return htmlStr;
}

function createBookmarks(htmlStr: string): Bookmark[] {
  // UrlDictionary
  const urlDictionary: UrlDictionary = {};
  const doc = new DOMParser().parseFromString(htmlStr, "text/html");
  const tagDtList = doc?.querySelectorAll("body > dl > dt");
  if (!tagDtList) throw new Error("");
  for (const tagDt of tagDtList) {
    const tag = extractTag(tagDt as Element);
    const dtList = (tagDt as Element).querySelectorAll("dl > dt");
    for (const dt of dtList) {
      const bookmark: Bookmark = extractBookmark(dt as Element);
      if (!urlDictionary[bookmark.url]) {
        urlDictionary[bookmark.url] = bookmark;
      }
      if (tag) {
        urlDictionary[bookmark.url].tags.push(tag);
      }
    }
  }
  // Bookmarks
  const bookmarks: Bookmark[] = [];
  for (const url in urlDictionary) {
    bookmarks.push(urlDictionary[url]);
  }
  bookmarks.sort((a, b) => {
    return a.date.getTime() - b.date.getTime();
  });
  return bookmarks;
}

function extractBookmark(dt: Element): Bookmark {
  const link = dt.querySelector("a") as Element;
  const title = link.textContent;
  const url = link.getAttribute("href");
  if (!url) throw new Error("No URL");
  const dateStr = (link as Element).getAttribute("add_date");
  if (!dateStr) throw new Error("No date");
  const date = new Date(parseInt(dateStr) / 1000);
  const memo = (dt.nextElementSibling?.tagName === "DD")
    ? dt.nextElementSibling.textContent.trim()
    : "";
  return {
    title,
    url,
    date,
    tags: [],
    memo,
  };
}

function extractTag(dt: Element): string {
  const tag = dt.querySelector("h3")?.textContent;
  if (!tag || tag === "ラベルなし") return "";
  return tag;
}

async function insertBookmarks(bookmarks: Bookmark[]) {
  const notion = new Client({
    auth: config().NOTION_TOKEN,
  });
  for await (const [index, bookmark] of bookmarks.entries()) {
    if (index < RESUME_FROM) continue;
    console.log(index, bookmark.title);
    insert(notion, bookmark);
    await sleep(1000);
  }
}

function insert(notion: Client, bookmark: Bookmark) {
  notion.pages.create({
    parent: {
      database_id: config().NOTION_DATABASE_ID,
    },
    properties: {
      Title: {
        type: "title",
        title: [
          {
            type: "text",
            text: {
              content: bookmark.title,
            },
          },
        ],
      },
      URL: {
        type: "url",
        url: bookmark.url,
      },
      Tags: {
        type: "multi_select",
        multi_select: bookmark.tags.map((tag) => {
          return {
            name: tag,
          };
        }),
      },
      "Date": {
        type: "date",
        date: {
          start: convertDateToJstString(bookmark.date),
        },
      },
      Memo: {
        type: "rich_text",
        rich_text: [
          {
            type: "text",
            text: {
              content: bookmark.memo || "",
            },
          },
        ],
      },
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertDateToJstString(date: Date) {
  const d = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().split("Z")[0] + "+09:00";
}

main();
