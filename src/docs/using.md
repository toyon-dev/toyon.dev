# Using Toyon

Each chat works on its own copy of your project, with the app running in the preview.

## Open a project

On first open, Toyon guesses a settings file from `package.json`, asks you to confirm it, and writes it to the project. For other stacks the guess is empty, and the agent can fill it in. See [settings.md](settings.md).

Run `toyon` outside a project to start without one. Describe a new project in a sentence, or paste a git URL into the project picker to clone it.

`toyon https://github.com/you/app` opens Toyon ready to clone that repository into the current folder. Links to a branch, a file or a pull request on GitHub, GitLab or Codeberg work too.

One Toyon holds every project you open.

## Start a chat

Your first message starts a copy of the project: a branch and a git worktree, with your dependencies and `.env` files. Sign in to your agent from the chat. Claude Code and Codex install on first start; install OpenCode from its row's menu. See [agents.md](agents.md).

- Main has no chat. Your checkout changes only when you land.
- Uncommitted files in your checkout can move into the copy.
- The dot beside each chat shows whether its app is up or it is waiting on you. The counts show what it changed.
- A copy nobody has looked at for two hours stops its servers. The chat and the agent keep going. See [settings.md](settings.md#sleep).
- A project without a page still works. The chat takes the middle instead of the preview.

## Ask for a change

Type what you want and send it. Toyon tells the agent which page you are on and what errors it has thrown. See [preview.md](preview.md#what-the-agent-is-told).

- **Point at the page.** Press cmd+E, or the pick button in the chat box, then click an element. It becomes a chip in your message, and the agent gets its component, file and line.
- **Steer.** Send a message while the agent is working. OpenCode cannot be steered mid-turn.
- **Run a command yourself.** Start the line with `!`. The agent is told what you ran with your next message, but not the output.
- **Split off part of the work.** `/handoff fix the footer` proposes a new copy for that piece. It starts when you approve. See [agents.md](agents.md).

## Check the change

The preview shows the copy's app. Your dev server reloads it as the agent writes.

- **Find what changed on the page.** Hover a file in the changes list to outline everything it draws on the current page. Hover a line in a diff to outline its element. A file that draws nothing on this page outlines nothing, so the change is on another page.
- **Open the code.** Press cmd+I and click an element to open its line in the editor. Hold alt while clicking to swap cmd+E and cmd+I.
- **See the design.** Press cmd+D for the design pane. It lists the copy's tokens, components and class families. Hover a row to outline its matches on the page; click it to open its source.
- **Fix it yourself.** You can browse the files, read and edit a diff, and run a terminal.
- **Run your check.** If the settings name a `check`, it runs after every finished turn and its output shows in the chat. `/check` runs it now.

If the server crashed, a card replaces the page. See [preview.md](preview.md#when-the-page-is-empty).

## Permission modes

Each chat has a mode, shown next to the prompt. Type `/auto`, `/ask` or `/plan` to switch.

| Mode | What the agent can do |
|---|---|
| auto | The default. Edits and sandboxed commands run. A plan still asks. |
| ask | Every edit and every command asks first. |
| plan | The agent reads and proposes only. Approving the plan starts the work, in auto or ask. |

What the sandbox allows in each is in [trust.md](trust.md).

## Land

Press land, or type `/land`, when the change looks right. Nothing is kept until then. If the settings name a `check`, it has to pass first.

- By default, land merges into main on your machine and pushes nothing.
- `land.route` in the settings can push main, or open a pull request instead. See [settings.md](settings.md#keys).
- `/archive` archives the copy once its work has landed.
- Only land pushes. Agents are told not to push or delete branches. See [trust.md](trust.md#pushing).

## Shortcuts

Press cmd+, for the full list.

## What it does not do

- It is not an editor. There is no multi-file editing, no debugger, no extensions and no inline completion.
- It works on git repositories only. A new project starts one for you.
- It does not keep copies apart from services they share. A database or a compose stack every copy points at is shared, migrations included. See [settings.md](settings.md#keeping-copies-apart).
- It does not carry a login between copies. Each preview has its own cookies, so a new chat's app starts signed out, and an OAuth provider cannot redirect into a preview.
