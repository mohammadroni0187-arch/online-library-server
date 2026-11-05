# BookNook API Server

Express + MongoDB API for **BookNook – A Small Online Library**. It stores the
books and borrow records and verifies the Better Auth JWT issued by the
Next.js frontend before it accepts any write request.

## Technology Stack

- Node.js, Express 5
- MongoDB Native Driver
- `jose` for JWT verification (EdDSA / RS256 / ES256)
- `cors`, `dotenv`

## Getting Started

```bash
npm install
npm run dev     # nodemon, http://localhost:8000
# or
npm start       # node index.js
```

## Environment Variables

Create a `.env` file in this folder (never commit it):

```bash
# MongoDB connection string (application data lives in the
# "Bookk-Nook" database, collections "Add-Book" and "Borrows")
MONGODB_URI=your-mongodb-connection-string

# Port, optional (defaults to 8000)
PORT=8000

# Origin of the Better Auth server (the Next.js app).
# Used for the JWKS lookup and for issuer/audience validation.
# Defaults to http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000

# Optional: comma separated list of origins allowed by CORS.
# Defaults to the BETTER_AUTH_URL value.
CLIENT_ORIGINS=http://localhost:3000
```

> Use placeholder values only in documentation. Real values belong in `.env`,
> which is git-ignored.

## Authentication

The frontend asks Better Auth for a token (`GET /api/auth/token`, session
cookie) and sends it as:

```
Authorization: Bearer <jwt>
```

The server verifies the token against the public keys published by Better Auth
at `GET /api/auth/jwks` (signature, expiry, issuer, audience) and derives the
caller identity from the token. Anything the client sends as `userEmail` or
`userName` is ignored.

## Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/` | – | Health check |
| GET | `/books` | – | All books, optional `?category=Fiction` |
| GET | `/books/latest` | – | Latest 6 books (registered before `/books/:id`) |
| GET | `/books/:id` | – | Single book (400 for invalid ObjectId, 404 if missing) |
| POST | `/books` | JWT | Add a book (`availableCopies = totalCopies`, `createdAt` set by the server) |
| POST | `/add-destination` | JWT | Legacy alias of `POST /books` |
| PATCH | `/books/:id` | JWT + owner | Update whitelisted fields only |
| DELETE | `/books/:id` | JWT + owner | Delete a book and its borrow records |
| GET | `/my-book` | JWT | Books added by the signed-in user |
| POST | `/borrows` | JWT | Borrow a book (atomic stock decrement, duplicate blocked) |
| GET | `/borrows` | JWT | Borrow records of the signed-in user |
| GET | `/my-borrows` | JWT | Alias of `GET /borrows` |
| DELETE | `/borrows/:id` | JWT + owner | Return a book (atomic, can only happen once) |

### Status codes

- `200` success, `201` created
- `400` invalid ObjectId / invalid payload / no stock
- `401` missing or invalid token
- `403` authenticated but not the owner
- `404` record not found
- `409` duplicate borrow or already returned
- `500` unexpected server error (details are logged, never leaked to the client)

## Data Model

**Book** (`Bookk-Nook.Add-Book`)

```
_id, title, author, category, image, description,
totalCopies, availableCopies, userName, userEmail, userId, createdAt
```

**Borrow** (`Bookk-Nook.Borrows`)

```
_id, bookId, bookTitle, bookImage, userName, userEmail,
borrowDate, returnDate, status, createdAt
```

A unique index on `{ bookId, userEmail }` makes sure a user cannot hold two
active borrows of the same book. Returning a book deletes the record, so the
same book can be borrowed again later.

## Concurrency

- Borrowing decrements `availableCopies` with a conditional
  `updateOne({ availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } })`,
  so the stock can never go below zero.
- Returning claims the borrow record with `findOneAndDelete`, so the same
  record can never be returned twice, and only increments the stock while
  `availableCopies < totalCopies`.
