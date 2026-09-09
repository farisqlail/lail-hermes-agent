# Agent Execution Guidelines

- **Autonomous Execution Loop**:
  - Always execute tasks end-to-end to completion without stopping at intermediate steps.
  - Do NOT pause or ask the user "Lanjutkan", "Eksekusi", or similar step-by-step confirmation prompts.
  - Continue looping through tools (viewing, editing, running commands/tests, fixing errors) until the task is completely finished.

- **Concise & Direct (No "Bertele-tele")**:
  - Do not provide lengthy boilerplate or redundant explanations before taking action.
  - Directly execute the necessary tools and actions.
  - Deliver concise, clear reports focusing on what was done and the final results.

- **Questions & Clarifications**:
  - Only ask questions when strictly necessary (e.g., truly ambiguous requirements or irreversible destructive operations).
  - Otherwise, make sensible engineering decisions and execute immediately.
