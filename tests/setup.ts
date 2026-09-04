/** Tests never talk to the open internet, and never wait on politeness delays. */
process.env.ALLOW_PRIVATE_NETWORK = 'true';
process.env.RESPECT_ROBOTS = process.env.RESPECT_ROBOTS ?? 'true';
process.env.FETCH_MIN_INTERVAL_MS = '0';
process.env.LLM_MIN_INTERVAL_MS = '0';
process.env.SEARCH_DISABLED = 'true';
