
import express from 'express';
import { MongoClient } from 'mongodb';
import 'dotenv/config';
import cors from 'cors'
import { ObjectId } from 'mongodb';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(cors());
// MongoDB Client
const client = new MongoClient(process.env.MONGODB_URI);
let addBookCollection;

let borrowsCollection;


// Database Connection
export async function connectToMongoDB() {
  try {
    await client.connect();

    console.log("Successfully connected to MongoDB!");

    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
  }
}

// Disconnect
export async function disconnectFromMongoDB() {
  await client.close();
  console.log("MongoDB disconnected!");
}
app.post('/add-destination', async (req, res) => {
  try {
    const data = {
      ...req.body,
      createdAt: new Date(),
    };

    const result = await addBookCollection.insertOne(data);

    res.status(201).send(result);
  } catch (error) {
    console.error("Error adding book:", error);

    res.status(500).send({
      message: "Failed to add book",
      error: error.message,
    });
  }
});

// My Books API
app.get('/my-book', async(req, res)=>{
  const result = await addBookCollection.find().toArray()
  res.send(result)
})

// New Arrivals API
app.get("/books/latest", async (req, res) => {
  try {
    const books = await addBookCollection
      .find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(6)
      .toArray();

    res.status(200).send(books);
  } catch (error) {
    console.error("Latest Books Error:", error);

    res.status(500).send({
      message: "Failed to fetch latest books",
    });
  }
});

// All Books API
app.get("/books", async (req, res) => {
  try {
    const books = await addBookCollection
      .find()
      .sort({ _id: -1 })
      .toArray();

    res.status(200).send(books);
  } catch (error) {
    console.error("All Books Error:", error);

    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});



// Details API
app.get("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const book = await addBookCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!book) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send(book);
  } catch (error) {
  console.error("Book Details API Error:", error);

  res.status(500).send({
    message: "Failed to fetch book",
    error: error.message,
  });
}
});
// patch API

app.patch("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBook = req.body;

    console.log("Book ID:", id);
    console.log("Updated Data:", updatedBook);

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    const result = await addBookCollection.updateOne(
  { _id: new ObjectId(id) },
  { $set: updatedBook }
);

console.log("MongoDB Update Result:", result);

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send({
      message: "Book updated successfully",
      result,
    });
  } catch (error) {
    console.error("PATCH API Error:", error);

    res.status(500).send({
      message: "Failed to update book",
      error: error.message,
    });
  }
});

app.delete("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check whether ID is valid
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid book ID",
      });
    }

    // Find and delete the book
    const result = await addBookCollection.deleteOne({
      _id: new ObjectId(id),
    });

    // Check whether the book exists
    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.status(200).send({
      message: "Book deleted successfully",
    });

  } catch (error) {
    console.error("Delete Book Error:", error);

    res.status(500).send({
      message: "Failed to delete book",
    });
  }
});

// my-borrows

app.post("/borrows", async (req, res) => {
  try {
    const {
      bookId,
      bookTitle,
      bookImage,
      userEmail,
      borrowDate,
      returnDate,
    } = req.body;

    if (!ObjectId.isValid(bookId)) {
      return res.status(400).send({ message: "Invalid book ID" });
    }

    if (!userEmail) {
      return res.status(400).send({ message: "User email is required" });
    }

    // ১. বইটি আগে থেকেই Borrow করা আছে কি না
    const existingBorrow = await borrowsCollection.findOne({
      bookId,
      userEmail,
    });

    if (existingBorrow) {
      return res.status(400).send({
        message: "You already borrowed this book",
      });
    }

    // ২. একটি available copy কমানো
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
        message: "No copies available",
      });
    }

    // ৩. Borrow record তৈরি করা
    const result = await borrowsCollection.insertOne({
      bookId,
      bookTitle,
      bookImage,
      userEmail,
      borrowDate,
      returnDate,
    });

    return res.status(201).send({
      message: "Book borrowed successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Borrow error:", error);

    return res.status(500).send({
      message: "Failed to borrow book",
    });
  }
});

app.get("/my-borrows", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({
        message: "User email is required",
      });
    }

    const borrows = await borrowsCollection.find({ userEmail: email }).sort({ _id: -1 }).toArray();

    res.status(200).send(borrows);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to get borrowed books",
    });
  }
});

app.delete("/borrows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid borrow ID",
      });
    }

    // ১. Borrow record খুঁজে বের করা
    const borrow = await borrowsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!borrow) {
      return res.status(404).send({
        message: "Borrow record not found",
      });
    }

    // ২. বইয়ের availableCopies এক বাড়ানো
    const stockResult = await addBookCollection.updateOne(
      { _id: new ObjectId(borrow.bookId) },
      { $inc: { availableCopies: 1 } }
    );

    if (stockResult.matchedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    // ৩. Borrow record delete করা
    await borrowsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    return res.status(200).send({
      message: "Book returned successfully",
    });
  } catch (error) {
    console.error("Return error:", error);

    return res.status(500).send({
      message: "Failed to return book",
    });
  }
});


// http://localhost:8000/add-destination
app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Start Server after Database Connection
async function startServer() {
  try {
   const mongoClient = await connectToMongoDB();
   const db =mongoClient.db("Bookk-Nook")
    addBookCollection = db.collection("Add-Book")
    borrowsCollection = db.collection("Borrows");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
