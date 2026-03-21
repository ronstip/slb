#!/usr/bin/env python3
"""Quick script to test brothers clustering thresholds on a real collection.

Usage:
    python -m workers.clustering.test_thresholds <collection_id> [--bt 0.25] [--mean 0.26] [--max 0.29]
"""

import argparse
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dotenv import load_dotenv
load_dotenv()

import numpy as np
from workers.shared.bq_client import BQClient
from workers.clustering.brothers import brothers_cluster


def main():
    parser = argparse.ArgumentParser(description="Test clustering thresholds")
    parser.add_argument("collection_id", help="Collection to test on")
    parser.add_argument("--bt", type=float, default=0.25, help="Brothers threshold")
    parser.add_argument("--mean", type=float, default=0.26, help="Max intra-group mean")
    parser.add_argument("--max", type=float, default=0.29, help="Max distance for ungrouped")
    args = parser.parse_args()

    bq = BQClient()
    print(f"Fetching embeddings for {args.collection_id}...")

    rows = bq.query(
        """
        SELECT pe.embedding
        FROM social_listening.posts p
        JOIN social_listening.post_embeddings pe ON pe.post_id = p.post_id
        WHERE p.collection_id = @collection_id
        """,
        {"collection_id": args.collection_id},
    )

    if len(rows) < 2:
        print(f"Only {len(rows)} posts with embeddings — need at least 2.")
        return

    # Parse embeddings
    embeddings = []
    for r in rows:
        val = r["embedding"]
        if isinstance(val, str):
            import json
            val = json.loads(val)
        elif hasattr(val, "get"):
            val = val.get("values", val)
        embeddings.append([float(x) for x in val])

    embeddings = np.array(embeddings, dtype=np.float32)
    print(f"Loaded {len(embeddings)} embeddings (dim={embeddings.shape[1]})")

    print(f"\nThresholds: bt={args.bt}, mean={args.mean}, max={args.max}")
    clusters, stats = brothers_cluster(
        embeddings,
        brothers_threshold=args.bt,
        max_intra_group_mean=args.mean,
        max_distance_for_ungrouped=args.max,
    )

    print(f"\nResults:")
    print(f"  Clusters: {stats.get('final_clusters', 0)}")
    print(f"  Ungrouped: {stats.get('ungrouped', 0)} / {len(embeddings)}")
    sizes = stats.get("cluster_sizes", [])
    if sizes:
        print(f"  Size range: {min(sizes)} - {max(sizes)}")
        print(f"  Mean size: {np.mean(sizes):.1f}")
        print(f"  Median size: {np.median(sizes):.1f}")
        print(f"  Top 10 sizes: {sorted(sizes, reverse=True)[:10]}")


if __name__ == "__main__":
    main()
