"""Brothers clustering algorithm — groups posts by embedding similarity.

Adapted from legacy code. Pure numpy/scipy, no external service dependencies.

Algorithm:
1. Find brother posts based on a distance threshold.
2. Combine brother groups based on mean distance between groups.
3. Assign ungrouped items to existing groups based on max distance threshold.
"""

import logging
from typing import Any

import numpy as np
from scipy.spatial.distance import cdist, squareform

logger = logging.getLogger(__name__)


def brothers_cluster(
    embeddings: np.ndarray,
    brothers_threshold: float = 0.25,
    max_intra_group_mean: float = 0.26,
    max_distance_for_ungrouped: float = 0.29,
) -> tuple[np.ndarray, dict[str, Any]]:
    """Cluster embeddings using the brothers algorithm.

    Args:
        embeddings: (N, D) array of embeddings.
        brothers_threshold: Max cosine distance for initial brother pairs.
        max_intra_group_mean: Max mean distance to combine groups.
        max_distance_for_ungrouped: Max distance to assign stragglers.

    Returns:
        clusters: (N,) array — cluster ID per post, NaN if unclustered.
        stats: Algorithm statistics dict.
    """
    n = embeddings.shape[0]
    if n < 2:
        return np.full(n, np.nan), {"error": "need at least 2 posts"}

    # Compute full cosine distance matrix
    logger.info("Computing cosine distance matrix for %d posts", n)
    dist = cdist(embeddings, embeddings, metric="cosine").astype(np.float32)
    np.fill_diagonal(dist, 0)

    # Phase 1: Find brother groups
    logger.info("Phase 1: finding brothers (threshold=%.3f)", brothers_threshold)
    brothers = _find_brothers(dist, brothers_threshold)
    logger.info("Found %d initial brother groups", len(brothers))

    # Phase 2: Combine groups
    logger.info("Phase 2: combining groups (mean_threshold=%.3f)", max_intra_group_mean)
    combined = _combine_groups(brothers, dist, max_intra_group_mean)
    logger.info("Combined into %d groups", len(combined))

    # Phase 3: Assign ungrouped
    logger.info("Phase 3: assigning ungrouped (max_dist=%.3f)", max_distance_for_ungrouped)
    final_groups, ungrouped = _assign_ungrouped(
        combined, dist, max_distance_for_ungrouped, max_intra_group_mean,
    )
    logger.info("Final: %d clusters, %d ungrouped", len(final_groups), len(ungrouped))

    # Build cluster assignment array
    clusters = np.full(n, np.nan)
    for idx, group in enumerate(final_groups):
        clusters[list(group)] = idx

    stats = {
        "brothers_groups": len(brothers),
        "combined_groups": len(combined),
        "final_clusters": len(final_groups),
        "ungrouped": len(ungrouped),
        "cluster_sizes": [len(g) for g in final_groups],
    }
    return clusters, stats


def _find_brothers(dist: np.ndarray, threshold: float) -> list[list[int]]:
    """Phase 1: Find cliques of mutually close posts."""
    n = dist.shape[0]
    valid = dist <= threshold
    visited: set[int] = set()
    groups: list[list[int]] = []

    for i in range(n):
        if i in visited:
            continue
        group = {i}
        visited.add(i)

        candidates = set(np.where(valid[i])[0].tolist()) - visited
        while candidates:
            member = next(iter(candidates))
            # Check compatibility with all current group members (vectorized)
            group_list = list(group)
            if np.all(dist[group_list, member] <= threshold):
                group.add(member)
                visited.add(member)
            candidates.discard(member)

        if len(group) > 1:
            groups.append(sorted(group))

    return groups


def _mean_distance(dist: np.ndarray, group_a: list[int], group_b: list[int]) -> float:
    """Mean pairwise distance between two groups."""
    return float(dist[np.ix_(group_a, group_b)].mean())


def _combine_groups(
    groups: list[list[int]], dist: np.ndarray, mean_threshold: float,
) -> list[list[int]]:
    """Phase 2: Merge groups whose combined mean distance is within threshold."""
    if not groups:
        return []

    combined: list[list[int]] = []
    processed: set[int] = set()

    for i in range(len(groups)):
        if i in processed:
            continue
        current = list(groups[i])
        processed.add(i)

        for j in range(i + 1, len(groups)):
            if j in processed:
                continue
            if _mean_distance(dist, current, groups[j]) <= mean_threshold:
                current.extend(groups[j])
                processed.add(j)

        combined.append(sorted(set(current)))

    return combined


def _assign_ungrouped(
    groups: list[list[int]],
    dist: np.ndarray,
    max_dist: float,
    max_mean: float,
) -> tuple[list[list[int]], list[int]]:
    """Phase 3: Assign ungrouped posts to nearest compatible group."""
    grouped = set()
    for g in groups:
        grouped.update(g)
    ungrouped = [i for i in range(dist.shape[0]) if i not in grouped]

    if not ungrouped:
        return groups, []

    updated = [list(g) for g in groups]
    still_ungrouped = []

    for item in ungrouped:
        best_idx = None
        best_mean = float("inf")

        for gi, group in enumerate(updated):
            if np.max(dist[item, group]) > max_dist:
                continue
            test = group + [item]
            new_mean = float(dist[np.ix_(test, test)].mean())
            if new_mean <= max_mean and new_mean < best_mean:
                best_mean = new_mean
                best_idx = gi

        if best_idx is not None:
            updated[best_idx].append(item)
        else:
            still_ungrouped.append(item)

    updated = [sorted(g) for g in updated]
    return updated, sorted(still_ungrouped)
