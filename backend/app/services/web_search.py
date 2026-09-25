from __future__ import annotations

import os
from dataclasses import dataclass

import httpx


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str


def _search_language(query: str) -> str:
    """Choose a Google language hint from the query script."""
    if any("\u0900" <= ch <= "\u097F" for ch in query):
        return "hi"

    if any("\u0C00" <= ch <= "\u0C7F" for ch in query):
        return "te"

    return "en"


async def web_search(
    query: str,
    max_results: int = 5,
) -> list[SearchResult]:
    query = (query or "").strip()

    if not query:
        return []

    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        print("SERPAPI_KEY is not configured.")
        return []

    hl = _search_language(query)

    params = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "gl": "in",
        "hl": hl,
        "num": max_results,
        "output": "json",
    }

    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
        ) as client:
            response = await client.get(
                "https://serpapi.com/search",
                params=params,
            )

        response.raise_for_status()

        data = response.json()

        if data.get("error"):
            print("SERPAPI ERROR:", data["error"])
            return []

        results: list[SearchResult] = []
        seen_urls: set[str] = set()

        # ---------------------------------------------------------
        # Google Answer Box
        # ---------------------------------------------------------
        answer_box = data.get("answer_box") or {}

        answer_text = str(
            answer_box.get("answer")
            or answer_box.get("snippet")
            or answer_box.get("result")
            or ""
        ).strip()

        if answer_text:
            answer_url = str(
                answer_box.get("link")
                or ""
            ).strip()

            if answer_url:
                seen_urls.add(answer_url)

            results.append(
                SearchResult(
                    title="Google Answer",
                    url=answer_url or "https://www.google.com/",
                    snippet=answer_text,
                )
            )

        # ---------------------------------------------------------
        # Knowledge Graph
        # ---------------------------------------------------------
        knowledge_graph = data.get("knowledge_graph") or {}

        kg_description = str(
            knowledge_graph.get("description")
            or ""
        ).strip()

        kg_title = str(
            knowledge_graph.get("title")
            or ""
        ).strip()

        kg_url = str(
            knowledge_graph.get("website")
            or knowledge_graph.get("knowledge_graph_search_link")
            or ""
        ).strip()

        if kg_description:
            if kg_url:
                seen_urls.add(kg_url)

            results.append(
                SearchResult(
                    title=kg_title or "Knowledge Graph",
                    url=kg_url or "https://www.google.com/",
                    snippet=kg_description,
                )
            )

        # ---------------------------------------------------------
        # Organic Google results
        # ---------------------------------------------------------
        for item in data.get("organic_results") or []:
            title = str(
                item.get("title")
                or ""
            ).strip()

            url = str(
                item.get("link")
                or ""
            ).strip()

            snippet = str(
                item.get("snippet")
                or ""
            ).strip()

            if not title or not url:
                continue

            if url in seen_urls:
                continue

            seen_urls.add(url)

            results.append(
                SearchResult(
                    title=title,
                    url=url,
                    snippet=snippet,
                )
            )

            if len(results) >= max_results:
                break

        # ---------------------------------------------------------
        # News fallback
        # ---------------------------------------------------------
        if len(results) < max_results:
            for item in data.get("news_results") or []:
                title = str(
                    item.get("title")
                    or ""
                ).strip()

                url = str(
                    item.get("link")
                    or ""
                ).strip()

                snippet = str(
                    item.get("snippet")
                    or item.get("source")
                    or ""
                ).strip()

                if not title or not url:
                    continue

                if url in seen_urls:
                    continue

                seen_urls.add(url)

                results.append(
                    SearchResult(
                        title=title,
                        url=url,
                        snippet=snippet,
                    )
                )

                if len(results) >= max_results:
                    break

        results = results[:max_results]

        print(
            f"SERPAPI SEARCH: {query} -> {len(results)} results"
        )

        for index, result in enumerate(results, 1):
            print(
                f"  {index}. {result.title}"
            )

        return results

    except httpx.HTTPStatusError as error:
        print(
            "SERPAPI HTTP ERROR:",
            error.response.status_code,
            error.response.text[:500],
        )
        return []

    except Exception as error:
        print(
            "SERPAPI SEARCH ERROR:",
            str(error),
        )
        return []

