"""
Elasticsearch client + helpers for the Search/Knowledge layer.

Indexes:
  - places_index
  - cafes_index
  - hotels_index
  - attractions_index
  - transport_index

Sharding strategy: route documents by region (asia, europe, india, etc.)
for cache locality and retrieval latency.
"""
import hashlib
from datetime import datetime, timezone
from typing import Any

from elasticsearch import AsyncElasticsearch, BadRequestError, NotFoundError

from config import settings

_es: AsyncElasticsearch | None = None

INDEXES = ["places_index", "cafes_index", "hotels_index", "attractions_index", "transport_index"]

REGION_MAP = {
    "japan": "asia", "tokyo": "asia", "kyoto": "asia", "india": "india",
    "delhi": "india", "mumbai": "india", "france": "europe", "paris": "europe",
    "italy": "europe", "rome": "europe",
}


def _get_es() -> AsyncElasticsearch:
    global _es
    if _es is None:
        _es = AsyncElasticsearch(settings.elasticsearch_url)
    return _es


def _region_for(destination: str) -> str:
    return REGION_MAP.get(destination.lower(), "global")


async def setup_indexes() -> None:
    """Create indexes with shard routing on first boot."""
    es = _get_es()
    mapping = {
        "settings": {"number_of_shards": 3, "number_of_replicas": 1},
        "mappings": {
            "properties": {
                "place_id": {"type": "keyword"},
                "name": {"type": "text"},
                "region": {"type": "keyword"},
                "tags": {"type": "keyword"},
                "rating": {"type": "float"},
                "location": {"type": "geo_point"},
                "last_updated": {"type": "date"},
                "raw": {"type": "object", "enabled": False},
            }
        },
    }
    for index in INDEXES:
        try:
            await es.indices.create(
                index=index,
                settings=mapping["settings"],
                mappings=mapping["mappings"],
            )
        except BadRequestError:
            pass  # index already exists


async def search_knowledge(index: str, query: str, destination: str, size: int = 10) -> list[dict]:
    """
    Cache-first retrieval. Returns cached results if fresh (< 7 days).
    """
    es = _get_es()
    region = _region_for(destination)
    response = await es.search(
        index=index,
        body={
            "query": {
                "bool": {
                    "must": {"multi_match": {"query": query, "fields": ["name", "tags"]}},
                    "filter": [
                        {"term": {"region": region}},
                        {"range": {"last_updated": {"gte": "now-7d/d"}}},
                    ],
                }
            },
            "size": size,
        },
        routing=region,
    )
    return [hit["_source"] for hit in response["hits"]["hits"]]


async def index_result(index: str, place_id: str, doc: dict, destination: str) -> None:
    """Store a normalized search result in the knowledge layer."""
    es = _get_es()
    region = _region_for(destination)
    doc["region"] = region
    doc["last_updated"] = datetime.now(timezone.utc).isoformat()
    await es.index(index=index, id=place_id, body=doc, routing=region)
