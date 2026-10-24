<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- AI agents live in src/lib/agents.server.ts and are exposed via src/lib/pipeline.functions.ts; why: keeps model calls server-only.
- SAP DSM feed is simulated in src/lib/dsm.ts behind fetchDsmFeed(); why: swap point for a real DSM OData connection.
