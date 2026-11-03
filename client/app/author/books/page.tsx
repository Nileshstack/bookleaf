import type { Metadata } from "next";
import { BooksView } from "./books-view";

export const metadata: Metadata = { title: "My books" };
// Client-side auth gate: see app/author/layout.tsx.
export const instant = false;

export default function BooksPage() {
  return <BooksView />;
}
