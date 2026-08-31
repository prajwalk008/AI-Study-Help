"""Unit tests for page-tail chunking (no external services)."""
import unittest

from app import config
from app.ingest import PageTailChunker


class PageTailChunkerTests(unittest.TestCase):
    def test_tail_carries_to_next_page(self):
        chunker = PageTailChunker("doc1", "test.pdf")
        words_a = " ".join(f"w{i}" for i in range(200))
        words_b = " ".join(f"x{i}" for i in range(200))
        chunks_a = chunker.process_page(1, words_a)
        self.assertTrue(chunks_a)
        tail = chunker.tail_words()
        self.assertEqual(len(tail), config.PAGE_TAIL_WORDS)

        chunks_b = chunker.process_page(2, words_b)
        self.assertTrue(chunks_b)
        first_b = chunks_b[0].text.split()
        self.assertEqual(first_b[: config.PAGE_TAIL_WORDS], tail)

    def test_tail_carries_across_instances(self):
        chunker1 = PageTailChunker("doc1", "test.pdf")
        words = " ".join(f"a{i}" for i in range(150))
        chunker1.process_page(1, words)
        tail = chunker1.tail_words()

        chunker2 = PageTailChunker("doc1", "test.pdf", initial_tail=tail, chunk_counter=chunker1.chunk_counter)
        more = chunker2.process_page(2, "intro continuation text here")
        self.assertTrue(more)
        self.assertTrue(more[0].text.startswith(" ".join(tail)))


if __name__ == "__main__":
    unittest.main()
