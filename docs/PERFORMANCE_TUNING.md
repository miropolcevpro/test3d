# Performance tuning

The runtime now uses a conservative adaptive texture strategy:

- low tier: no adjacent prefetch, albedo-first warmup, no height map loading in AR
- balanced tier: one neighbor prefetch, albedo+roughness warmup, delayed heavy maps
- high tier: up to two neighbor prefetches, optional 2k outside AR, normal-map warmup, faster deferred refinement

The tuner uses device memory, hardware concurrency, network hints, and observed texture decode timings.

## Query overrides

- `?tex=1k` or `?tex=2k` force preferred texture quality
- `?prefetch=0|1|2` override adjacent prefetch count
- `?warm=off|all` override warmup behavior
- `?maps=lite|full` control deferred heavy-map loading

These overrides are intended for profiling and controlled testing.
