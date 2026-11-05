
import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
const PORT = process.env.PORT || 8000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The Next.js client that is allowed to call this API (comma separated).
const clientOrigins = (
  process.env.CLIENT_ORIGINS ||
  process.env.BETTER_AUTH_URL ||
  `${process.env.CLIENT_URI}`
)
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Base URL of the Better Auth server (the Next.js app).
const authBaseUrl = (process.env.BETTER_AUTH_URL || 'http://localhost:3000')
  .trim()
  .replace(/\/$/, '');
const jwksUrl = `${authBaseUrl}/api/auth/jwks`;

const BOOK_CATEGORIES = ['Fiction', 'Science', 'History', 'Kids', 'Others'];

// Fields a client is allowed to change on a book. Identity fields
// (userName / userEmail / userId / availableCopies / createdAt) are never
// taken from the request body.
const EDITABLE_BOOK_FIELDS = [
  'title',
  'author',
  'category',
  'image',
  'description',
  'totalCopies',
];

// Middleware
app.use(express.json());
app.use(cors({ origin: clientOrigins }));

// MongoDB Client
const client = new MongoClient(process.env.MONGODB_URI);
let mongoClient;
let addBookCollection;
let borrowsCollection;

// ---------------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------------

export async function connectToMongoDB() {
  try {
    await client.connect();

    console.log('Successfully connected to MongoDB!');

    return client;
  } catch (err) {
    console.error('MongoDB connection failed:', err);
    throw err;
  }
}

// Disconnect
export async function disconnectFromMongoDB() {
  await client.close();
  console.log('MongoDB disconnected!');
}

// ---------------------------------------------------------------------------
// JWT verification
//
// Better Auth issues the JWT (GET /api/auth/token) and publishes the public
// keys used to sign it at GET /api/auth/jwks. This middleware verifies the
// signature, the expiry, the issuer and the audience of the token and puts the
// authenticated identity on req.user. Nothing sent by the client is trusted as
// proof of identity.
// ---------------------------------------------------------------------------

let jwksSet = null;

function getJwks() {
  if (!jwksSet) {
    jwksSet = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }
  return jwksSet;
}

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).send({
      message: 'Unauthorized: a valid bearer token is required',
    });
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: authBaseUrl,
      audience: authBaseUrl,
      algorithms: ['EdDSA', 'RS256', 'ES256'],
    });

    if (!payload.sub || !payload.email) {
      return res.status(401).send({
        message: 'Unauthorized: token is missing user information',
      });
    }

    req.user = {
      id: String(payload.sub),
      email: String(payload.email),
      name: typeof payload.name === 'string' ? payload.name : '',
      image: typeof payload.image === 'string' ? payload.image : '',
    };

    return next();
  } catch (error) {
    console.error('JWT verification failed:', error.message);

    return res.status(401).send({
      message: 'Unauthorized: invalid or expired token',
    });
  }
}

// Only the user who added a book may edit or delete it.
function ownsBook(book, user) {
  if (!book || !user) return false;
  if (book.userId && String(book.userId) === user.id) return true;
  return book.userEmail === user.email;
}

function isValidId(id) {
  return typeof id === 'string' && ObjectId.isValid(id);
}

function readBookPayload(data = {}) {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const author = typeof data.author === 'string' ? data.author.trim() : '';
  const category =
    typeof data.category === 'string' ? data.category.trim() : '';
  const image = typeof data.image === 'string' ? data.image.trim() : '';
  const description =
    typeof data.description === 'string' ? data.description.trim() : '';
  const totalCopies = Number(data.totalCopies);

  const errors = [];

  if (!title) errors.push('Book title is required');
  if (!author) errors.push('Author name is required');
  if (!BOOK_CATEGORIES.includes(category)) {
    errors.push(`Category must be one of: ${BOOK_CATEGORIES.join(', ')}`);
  }
  if (!image) errors.push('Book cover image is required');
  if (!Number.isFinite(totalCopies) || totalCopies < 1) {
    errors.push('Total copies must be at least 1');
  }

  return { errors, value: { title, author, category, image, description, totalCopies } };
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

// Add Book API (POST /books) - the legacy path stays available for
// compatibility with older clients, both routes share the same handler.
async function addBookHandler(req, res) {
  try {
    const { errors, value } = readBookPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).send({ message: errors.join(', ') });
    }

    const bookData = {
      ...value,
      availableCopies: value.totalCopies,
      // Identity always comes from the verified token, never from the body.
      userName: req.user.name,
      userEmail: req.user.email,
      userId: req.user.id,
      createdAt: new Date(),
    };

    const result = await addBookCollection.insertOne(bookData);

    res.status(201).send({
      message: 'Book added successfully',
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error('Add Book Error:', error);

    res.status(500).send({
      message: 'Failed to add book',
    });
  }
}

app.post('/books', requireAuth, addBookHandler);
// Legacy endpoint kept so existing clients keep working.
app.post('/add-destination', requireAuth, addBookHandler);

// New Arrivals API - must be registered before GET /books/:id
app.get('/books/latest', async (req, res) => {
  try {
    const latestBooks = await addBookCollection
      .find({})
      .sort({ _id: -1 })
      .limit(6)
      .toArray();

    res.status(200).send(latestBooks);
  } catch (error) {
    console.error('Latest Books Error:', error);

    res.status(500).send({
      message: 'Failed to fetch latest books',
    });
  }
});

// All Books API (optional ?category= filter)
app.get('/books', async (req, res) => {
  try {
    const category =
      typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const filter = category ? { category } : {};

    const books = await addBookCollection
      .find(filter)
      .sort({ _id: -1 })
      .toArray();

    res.status(200).send(books);
  } catch (error) {
    console.error('All Books Error:', error);

    res.status(500).send({
      message: 'Failed to fetch books',
    });
  }
});

// Book Details API
app.get('/books/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        message: 'Invalid book ID',
      });
    }

    const book = await addBookCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).send({
        message: 'Book not found',
      });
    }

    res.status(200).send(book);
  } catch (error) {
    console.error('Book Details API Error:', error);

    res.status(500).send({
      message: 'Failed to fetch book',
    });
  }
});

// Update Book API - only the owner may update, only known fields change.
app.patch('/books/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        message: 'Invalid book ID',
      });
    }

    const book = await addBookCollection.findOne({ _id: new ObjectId(id) });

    if (!book) {
      return res.status(404).send({
        message: 'Book not found',
      });
    }

    if (!ownsBook(book, req.user)) {
      return res.status(403).send({
        message: 'You are not allowed to update this book',
      });
    }

    const body = req.body || {};
    const update = {};

    for (const field of EDITABLE_BOOK_FIELDS) {
      if (body[field] !== undefined) update[field] = body[field];
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).send({
        message: 'No editable fields were provided',
      });
    }

    const { errors, value } = readBookPayload({ ...book, ...update });

    if (errors.length > 0) {
      return res.status(400).send({ message: errors.join(', ') });
    }

    // Keep the book counts consistent with the active borrow records.
    const borrowedCount = await borrowsCollection.countDocuments({
      bookId: id,
    });

    update.title = value.title;
    update.author = value.author;
    update.category = value.category;
    update.image = value.image;
    update.description = value.description;
    update.totalCopies = value.totalCopies;
    update.availableCopies = Math.max(0, value.totalCopies - borrowedCount);

    const result = await addBookCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: 'Book not found',
      });
    }

    res.status(200).send({
      message: 'Book updated successfully',
      result,
    });
  } catch (error) {
    console.error('PATCH API Error:', error);

    res.status(500).send({
      message: 'Failed to update book',
    });
  }
});

// Delete Book API - only the owner may delete.
app.delete('/books/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).send({
        message: 'Invalid book ID',
      });
    }

    const book = await addBookCollection.findOne({ _id: new ObjectId(id) });

    if (!book) {
      return res.status(404).send({
        message: 'Book not found',
      });
    }

    if (!ownsBook(book, req.user)) {
      return res.status(403).send({
        message: 'You are not allowed to delete this book',
      });
    }

    // Remove borrow records that point at the deleted book so no dangling
    // reference is left behind.
    await borrowsCollection.deleteMany({ bookId: id });

    const result = await addBookCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: 'Book not found',
      });
    }

    res.status(200).send({
      message: 'Book deleted successfully',
    });
  } catch (error) {
    console.error('Delete Book Error:', error);

    res.status(500).send({
      message: 'Failed to delete book',
    });
  }
});

// My Books API - identity comes from the verified token.
app.get('/my-book', requireAuth, async (req, res) => {
  try {
    const result = await addBookCollection
      .find({ userEmail: req.user.email })
      .sort({ _id: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error('My Books Error:', error);

    res.status(500).send({
      message: 'Failed to fetch books',
    });
  }
});

// ---------------------------------------------------------------------------
// Borrows
// ---------------------------------------------------------------------------

// Borrow a book: decrement stock atomically, then store the borrow record.
app.post('/borrows', requireAuth, async (req, res) => {
  try {
    const { bookId, borrowDate, returnDate } = req.body || {};

    if (!isValidId(bookId)) {
      return res.status(400).send({ message: 'Invalid book ID' });
    }

    const book = await addBookCollection.findOne({
      _id: new ObjectId(bookId),
    });

    if (!book) {
      return res.status(404).send({ message: 'Book not found' });
    }

    // One active borrow per user and book.
    const existingBorrow = await borrowsCollection.findOne({
      bookId,
      userEmail: req.user.email,
    });

    if (existingBorrow) {
      return res.status(409).send({
        message: 'You already borrowed this book',
      });
    }

    const borrowedAt = borrowDate ? new Date(borrowDate) : new Date();
    const dueAt = returnDate
      ? new Date(returnDate)
      : new Date(borrowedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(borrowedAt.getTime()) || Number.isNaN(dueAt.getTime())) {
      return res.status(400).send({ message: 'Invalid borrow or return date' });
    }

    if (dueAt.getTime() <= borrowedAt.getTime()) {
      return res.status(400).send({
        message: 'Return date must be after the borrow date',
      });
    }

    // Atomic decrement: never lets availableCopies go below 0.
    const stockResult = await addBookCollection.updateOne(
      {
        _id: new ObjectId(bookId),
        availableCopies: { $gt: 0 },
      },
      {
        $inc: { availableCopies: -1 },
      }
    );

    if (stockResult.modifiedCount === 0) {
      return res.status(400).send({
        message: 'No copies available',
      });
    }

    try {
      const result = await borrowsCollection.insertOne({
        bookId,
        bookTitle: book.title,
        bookImage: book.image,
        userName: req.user.name,
        userEmail: req.user.email,
        borrowDate: borrowedAt.toISOString(),
        returnDate: dueAt.toISOString(),
        status: 'active',
        createdAt: new Date(),
      });

      return res.status(201).send({
        message: 'Book borrowed successfully',
        insertedId: result.insertedId,
      });
    } catch (insertError) {
      // Give the copy back so the stock stays correct.
      await addBookCollection.updateOne(
        { _id: new ObjectId(bookId) },
        { $inc: { availableCopies: 1 } }
      );
      throw insertError;
    }
  } catch (error) {
    console.error('Borrow error:', error);

    return res.status(500).send({
      message: 'Failed to borrow book',
    });
  }
});

// Borrow records of the authenticated user.
async function getMyBorrows(req, res) {
  try {
    const borrows = await borrowsCollection
      .find({ userEmail: req.user.email })
      .sort({ _id: -1 })
      .toArray();

    res.status(200).send(borrows);
  } catch (error) {
    console.error('My Borrows Error:', error);

    res.status(500).send({
      message: 'Failed to get borrowed books',
    });
  }
}

app.get('/borrows', requireAuth, getMyBorrows);
// Legacy path kept for existing clients.
app.get('/my-borrows', requireAuth, getMyBorrows);

// Return a book: only the owner of the record may return it, and the record is
// removed atomically so the same borrow can never be returned twice.
app.delete('/borrows/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({
        message: 'Invalid borrow ID',
      });
    }

    const borrow = await borrowsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!borrow) {
      return res.status(404).json({
        message: 'Borrow record not found',
      });
    }

    if (borrow.userEmail !== req.user.email) {
      return res.status(403).json({
        message: 'You are not allowed to return this book',
      });
    }

    // Atomic claim: only one request can delete the record.
    const claimed = await borrowsCollection.findOneAndDelete({
      _id: new ObjectId(id),
      userEmail: req.user.email,
    });

    if (!claimed) {
      return res.status(409).json({
        message: 'This book has already been returned',
      });
    }

    if (isValidId(borrow.bookId)) {
      const book = await addBookCollection.findOne({
        _id: new ObjectId(borrow.bookId),
      });

      if (book) {
        // Only increment while there is room left, so the count can never
        // exceed totalCopies.
        await addBookCollection.updateOne(
          {
            _id: new ObjectId(borrow.bookId),
            availableCopies: { $lt: book.totalCopies },
          },
          { $inc: { availableCopies: 1 } }
        );
      }
    }

    return res.status(200).json({
      message: 'Book returned successfully',
    });
  } catch (error) {
    console.error('Return API Error:', error);

    return res.status(500).json({
      message: 'Failed to return book',
    });
  }
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.send('BookNook API is running');
});

// Unknown API routes
app.use((req, res) => {
  res.status(404).send({ message: 'Route not found' });
});

// Start Server after Database Connection
async function startServer() {
  try {
    mongoClient = await connectToMongoDB();

    // The books live in their own database next to the Better Auth database.
    const db = mongoClient.db('Bookk-Nook');

    addBookCollection = db.collection('Add-Book');
    borrowsCollection = db.collection('Borrows');

    // A user may only hold one active borrow of the same book. Returning a
    // book deletes the record, so the same book can be borrowed again later.
    try {
      await borrowsCollection.createIndex(
        { bookId: 1, userEmail: 1 },
        { unique: true }
      );
    } catch (indexError) {
      console.warn('Could not create borrow index:', indexError.message);
    }

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Server failed to start:', error);
    process.exit(1);
  }
}

startServer();
export default app;