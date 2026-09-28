import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeSvg, innerSvg, monochrome } from "./app-icons.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const brand = (name) => readFileSync(resolve(here, "../../../brand", name), "utf8");

describe("app icons", () => {
  it("takes the drawing out of a brand SVG, without the <svg> wrapper", () => {
    const inner = innerSvg(brand("logo-icon-inverse.svg"));
    expect(inner.startsWith("<path")).toBe(true);
    expect(inner).not.toContain("<svg");
    expect(inner).not.toContain("</svg>");
  });

  it("forces every stroke and fill to one colour — the notification icon's silhouette", () => {
    const white = monochrome(innerSvg(brand("logo-icon-mono.svg")), "#FFFFFF");
    const colours = [...white.matchAll(/(?:stroke|fill)="(#[0-9A-Fa-f]+)"/g)].map(
      (m) => m[1],
    );
    expect(colours.length).toBeGreaterThan(0);
    expect(new Set(colours)).toEqual(new Set(["#FFFFFF"]));
    // "none" is not a colour and stays, or the strokes would fill in.
    expect(white).toContain('fill="none"');
  });

  it("centres the mark at its scale, with a ground only when asked", () => {
    const svg = composeSvg({ inner: "<path/>", scale: 0.5, size: 1024 });
    expect(svg).toContain('width="1024"');
    expect(svg).toContain("translate(12 12) scale(0.5)");
    expect(svg).not.toContain("<rect");
    expect(
      composeSvg({ inner: "<path/>", scale: 0.5, size: 8, ground: "#0B2545" }),
    ).toContain('<rect width="48" height="48" fill="#0B2545"/>');
  });
});
