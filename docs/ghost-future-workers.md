## Ghost Future Workers

Design goal:
- Keep capabilities scoped per worker, not universal.
- Extend Ghost without destabilizing the live `ghost-chat-v3` route.

Planned worker contracts:
- `research_worker`
  - intended trigger: explicit requests for web search, freshness, citations, or URL-grounded synthesis
  - approval expectation: generally low-risk/read-only, but still explicit-route only
  - artifact/log expectation: source list, citation bundle, optional retrieval artifact path
  - default status: disabled by default until Phase 4 memory work is stable
- `browser_worker`
  - intended trigger: explicit browser navigation, screenshot, scraping, or page-interaction tasks
  - approval expectation: stronger approval than research; lab/caution by default
  - artifact/log expectation: screenshots, action log, extracted results, failure summary
  - default status: lab only, not in normal live routing
- `coding_worker`
  - intended trigger: technical implementation and repo/workspace tasks
  - approval expectation: keep the current Codex risk gate model, with scoped command execution and structured block responses
  - artifact/log expectation: reply artifact, stdout/stderr summaries, stable command metadata
  - default status: live now through the current `codex_oauth_worker` path

Routing guidance:
- Insert any new worker branches after classification and before provider execution.
- Keep worker-specific approval logic attached to the route before execution.
- Do not turn research or browser into default fallbacks for normal chat.

Recommended rollout order:
- Phase 4:
  - structured memory first
  - explicit-route `research_worker` second
- Later phase:
  - `browser_worker` in lab mode with heavy logging and stronger approvals

Non-goals for the next worker pass:
- no major rewrite of the live Ghost core
- no universal toolbox abstraction
- no live browser automation by default
