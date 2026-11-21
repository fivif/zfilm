# @openfilm/shared

What Zfilm's clients share: a chat turn and the events a client sees, how an agent's activity reads, prompt
references, title limits and Markdown parsing.

```ts
import { buildPromptDisplay, type Turn } from '@openfilm/shared';
import { scanMarkdownBlocks } from '@openfilm/shared/markdown';
```

Part of [Zfilm](https://github.com/openfilm/openfilm). MIT licensed.
