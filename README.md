# A&H Mobiles Shop Manager

A mobile-first Next.js app for mobile-shop sales, repair intake, service tracking,
customers, payments, reports, and printable invoices.

## Requirements

- Node.js 22 or later
- A Firebase project with Email/Password Authentication and Cloud Firestore
- A Firebase Admin service account for trusted invoice, payment, and service-status operations

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without Firebase browser
configuration, the app opens in **Local preview** mode and saves only to this
browser. Do not enter real customer or payment information in preview mode.

## Configure Firebase

1. Create a Firebase project and register a Web app.
2. Enable **Authentication → Sign-in method → Email/Password**.
3. Create a Cloud Firestore database.
4. Put the Web app's API key, auth domain, project ID, and app ID in the
   `NEXT_PUBLIC_FIREBASE_*` values in `.env.local`.
5. Create a service account with only the required Firebase Authentication
   verification and Firestore access. Set `FIREBASE_ADMIN_PROJECT_ID`,
   `FIREBASE_ADMIN_CLIENT_EMAIL`, and `FIREBASE_ADMIN_PRIVATE_KEY` on the server.
   The private key is server-only; preserve its newlines (or use `\n` escapes).
   On Google Cloud, prefer the platform's workload identity/application default
   credentials and adapt `app/lib/firebase-admin.ts` rather than storing a key.
6. Deploy `firestore.rules` and `firestore.indexes.json`:

   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes
   ```

7. Restart the Next.js server after changing environment variables. Sign up with
   the account that will own the shop workspace.

Shop records are scoped to the authenticated user's UID. Financial record
creation, sequence allocation, and payment/status mutations go through the
server route at `app/api/records/route.ts`; Firestore rules prevent browser-side
invoice, counter, and payment writes. Review the rules and service-account
permissions before production deployment.

## Workflows

- **Sales:** product rows, line and invoice discounts, optional tax, initial and
  follow-up payments, searchable history, live preview, A4 PDF, and printing.
- **Services:** intake details and condition, service charge and discount,
  status tracking, optional later amount-only payments, ready-for-pickup list,
  handover details/history, receipt PDF and thermal printing. The app
  deliberately has no device-password or pattern fields; never put unlock
  credentials in notes.
- **Customers:** customer directory, deduplication by contact number, and
  associated sale and repair history.
- **Reports:** date range, revenue and collection totals, service status, and CSV
  export. The dashboard revenue chart also supports a custom date range.
- **Settings:** shop details and GSTIN, PNG/JPEG logo on invoices, invoice prefixes/footer, and A4 or 80 mm thermal printing.

## Verification

```powershell
npx tsc --noEmit
npm run lint
npm run build
```
