# Contributing to LifeDash

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/)

No Docker or external database required — LifeDash uses PGlite (embedded WASM PostgreSQL).

## Getting Started

```bash
git clone https://github.com/Lab-51/lifedash.git
cd lifedash
npm install
npm start
```

## How to Contribute

### Reporting Issues

- Search [existing issues](https://github.com/Lab-51/lifedash/issues) first
- Include steps to reproduce, expected vs actual behavior, and your OS/Node version
- Screenshots are helpful for UI issues

### Submitting Changes

1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b my-feature`
3. **Make your changes** — keep commits focused and descriptive
4. **Run checks** before submitting:
   ```bash
   npm run lint    # TypeScript type checking
   npm test        # Run test suite
   ```
5. **Open a Pull Request** against `main` with a clear description of what and why

### Code Style

The project uses TypeScript with React. Follow the existing patterns in the codebase:

- Functional React components with hooks
- Tailwind CSS for styling
- Vitest for testing

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
