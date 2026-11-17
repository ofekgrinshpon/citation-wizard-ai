import { describe, expect, it } from "vitest";
import { bookCatalogueAuthorMatches, extractBookPublicationEvidence as extract } from "../../supabase/functions/_shared/citationPure/bookPublicationEvidence";
const title = "National Identity", author = "Anthony D. Smith";
describe("structurally bound book catalogue metadata", () => {
  it.each([
    ["National Identity. Anthony D. Smith. Penguin, 1991", "1991"],
    ["National Identity - Anthony D. Smith - Google Books ... Penguin, 1991", "1991"],
    ["National Identity — Anthony D. Smith — Google Books … Penguin, 1991", "1991"],
    ["National Identity. Smith, Anthony D. Publisher: University of Nevada Press, 1993", "1993"],
    ["National Identity. Anthony D. Smith. Publisher: University of Nevada Press. Publication date: 1993", "1993"],
    ["National Identity. Anthony D. Smith. University of Nevada Press, 1993", "1993"],
    ["National Identity. Anthony D. Smith. Penguin, 1991 - Ethnic relations - 227 pages", "1991"],
    ["National Identity by Anthony D. Smith. Paperback. Published: March 1, 1993. ISBN 9780874172041. About the author: Anthony D. Smith (1939–2016).", "1993"],
  ])("accepts bounded catalogue row %s", (text, year) => expect(extract(text, title, author)).toEqual({ year }));
  it.each([
    "National Identity. Anthony J. Smith. Penguin, 1991",
    "National Identity. John Smith. Penguin, 1991",
    "National Identity. Anthony D. Smith. 1991",
    "National Identity. Anthony D. Smith. Copyright 1991",
    "National Identity. Anthony D. Smith. Publisher: Copyright, 1991",
    "National Identity. Anthony D. Smith. Other Work. Penguin, 1999",
    "National Identity - Anthony D. Smith - Google Books. A reference to Other Work. Penguin, 1999",
    "National Identity. Anthony D. Smith reviewed Other Work. Penguin, 1999",
    "References: National Identity. Anthony D. Smith. Penguin, 1991",
    "Bibliography: National Identity. Anthony D. Smith. Penguin, 1991",
    "Review: National Identity. Anthony D. Smith. Penguin, 1991",
    "National Identity. Anthony D. Smith. Publisher: Other Work (1999)",
    "National Identity. Anthony D. Smith. Penguin, 1991 edition discussed in 1999",
    "National Identity. Anthony D. Smith. Penguin, 1991–1993",
    "National Identity. Anthony D. Smith. Copyright: March 1, 1993.",
  ])("rejects unbound or non-publication row %s", text => expect(extract(text, title, author)).toEqual({}));
  it("requires supplied author for catalogue forms", () => expect(extract("National Identity. Anthony D. Smith. Penguin, 1991", title)).toEqual({}));
  it("does not select between two years", () => expect(extract("National Identity. Anthony D. Smith. Penguin, 1991; National Identity. Anthony D. Smith. Penguin, 1993", title, author)).toEqual({}));
  it("retains existing strict form without author and does not guess edition", () => expect(extract("National Identity (1991)", title)).toEqual({ year: "1991" }));
  it("binds the catalogue heading byline without requiring a date", () => {
    expect(bookCatalogueAuthorMatches("National Identity - Anthony D. Smith - Google Books", title, "Smith, Anthony D")).toBe(true);
    expect(bookCatalogueAuthorMatches("National Identity - Anthony J. Smith - Google Books", title, "Smith, Anthony D")).toBe(false);
    expect(bookCatalogueAuthorMatches("National Identity - Anthony D. Smith-Jones - Google Books", title, "Smith, Anthony D")).toBe(false);
    expect(bookCatalogueAuthorMatches("National Identity and Globalization - Anthony D. Smith", title, "Smith, Anthony D")).toBe(false);
  });
});
