# PlainGL.com

A Vercel-friendly Next.js app for PlainGL.com — a plain-text general ledger
accounting workspace with professional financial reports (P&L, P&L Detail,
Balance Sheet) you fully own.

> Internal note: storage and config keys retain the legacy `beanbooks.*` /
> `bb_*` prefixes for backward compatibility with existing saved data.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

The app uses the Next.js App Router and builds to `.next`, which is the output
directory Vercel expects for a Next.js deployment.

## Included Shape

- edit site code under `app/`
- static assets live under `public/`
- Vercel deployment settings live in `vercel.json`
- `next.config.ts` is the Next.js configuration entrypoint

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the Next.js production build
- `npm run start`: run the production server after building

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel Next.js Deployments](https://vercel.com/docs/frameworks/nextjs)
