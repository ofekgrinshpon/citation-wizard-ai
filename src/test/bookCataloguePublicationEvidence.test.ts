import { describe, expect, it } from "vitest";
import { bookSourceHeadingMatches, bookCatalogueAuthorMatches, extractBookPublicationEvidence as extract } from "../../supabase/functions/_shared/citationPure/bookPublicationEvidence";
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

describe("whole-work title occurrence boundaries", () => {
  it.each([
    "Chosen Peoples: Sacred Sources of National Identity. By Anthony D. Smith. Oxford University Press, 2003.",
    "Chosen Peoples: Sacred Sources of National Identity (2003)",
    "Chosen Peoples: Sacred Sources of National Identity. Publication year: 2003",
    "Chosen Peoples: National Identity (2003)",
    "Chosen Peoples: Sacred Sources of\nNational Identity (2003)",
    "Chosen Peoples:\nNational Identity (2003)",
    "Chosen Peoples — National Identity (2003)",
    "The Origins of National Identity (2003)",
    "Chosen Peoples, National Identity (2003)",
  ])("cannot mine a suffix/subtitle: %s", text => {
    expect(extract(text, title, author)).toEqual({});
    expect(bookCatalogueAuthorMatches(text, title, author)).toBe(false);
  });
  it.each([
    "National Identity. By Anthony D. Smith. Penguin, 1991.",
    "Anthony D. Smith, National Identity (1991)",
    "Smith, Anthony D., National Identity (1991)",
    "Title: National Identity. Publication year: 1991",
    "Book title: National Identity (1991)",
    "Catalogue record\nNational Identity (1991)",
    "Heading | National Identity (1991)",
    "Earlier record; National Identity (1991)",
    "National Identity — Anthony D. Smith Anthony D. Smith, National Identity (1991)",
  ])("keeps a bound record: %s", text => expect(extract(text, title, author)).toEqual({ year: "1991" }));
  it("requires expected author to accept a multiword byline rather than another work", () => {
    expect(extract("Chosen Peoples, National Identity (2003)", title)).toEqual({});
  });
});

describe("source heading whole-work match", () => {
  it.each(["National Identity", "National Identity - Anthony D. Smith - Google Books", "Anthony D. Smith, National Identity", "Title: National Identity"])("accepts %s", heading => expect(bookSourceHeadingMatches(heading, title, author)).toBe(true));
  it.each(["Chosen Peoples: Sacred Sources of National Identity", "National Identity and Globalization", "Chosen Peoples — National Identity", "John Smith, National Identity"])("rejects %s", heading => expect(bookSourceHeadingMatches(heading, title, author)).toBe(false));
  it("accepts initials", () => expect(bookSourceHeadingMatches("The Concept of Law — H.L.A. Hart", "The Concept of Law", "Hart, H.L.A.")).toBe(true));
});
