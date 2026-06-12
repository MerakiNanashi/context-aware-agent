# Issues



1. rigid context manager - can implement tier type summarization or temporal summarization using exact/fuzzy matching or softer socring with domain specific mapping | Key tradeoff: deterministic, low latency & gauranteed context summarization vs high latency, non deterministic embedding/llm dependent summarization

2. The LLM always skip searchKb tool - deemed as an redundant step

3. Context trace is not being written consistently

4. Token budgeting isn't dynamic -> should be calculated based on prompt + query tokens, etc.

5.







# Future work:



- adding vector emb search for context (both session history & roadmap) summarization

- soft scorer using vector search & exact/fuzzy match

- optimization of code & structure 

