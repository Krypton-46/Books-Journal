import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pg from "pg";
import dotenv from "dotenv";
const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const img_URL = "https://covers.openlibrary.org/b/isbn/";
db.connect();
const app = express();
const port = 3000;
let books = [];
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
dotenv.config();
app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.get("/", (req, res) => {
  res.render("login.ejs");
});
app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});
app.post("/signup", async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  try {
    await db.query("insert into users (email,password) values ($1,$2)", [
      email,
      password,
    ]);
    res.redirect("/");
  } catch (error) {
    res.render("error.ejs", { err: error, msg: "User already exist" });
  }
});
app.post("/login", async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  try {
    const result = await db.query("select password from users where email=$1", [
      email,
    ]);
    const correctPassword = result.rows[0].password;
    if (password == correctPassword) {
      const result = await db.query("select * from book where email=$1", [
        email,
      ]);
      books = result.rows;
      req.session.email = email;
      res.render("index.ejs", { books: books, email: req.session.email });
    } else {
      res.render("error.ejs", { msg: "Password does not match" });
    }
  } catch (error) {
    res.render("error.ejs", { err: error, msg: "User does not exist" });
  }
});
app.get("/new", (req, res) => {
  res.render("new.ejs");
});
app.get("/book/:isbn", async (req, res) => {
  const isbn = req.params.isbn;
  const result = await db.query(
    "select * from book where isbn=$1 and email=$2",
    [isbn, req.session.email]
  );
  const book = result.rows[0];
  res.render("book.ejs", { book: book });
});
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.render("error.ejs", { msg: "Error logging out" });
    }
    res.redirect("/"); // back to login
  });
});

app.post("/new", async (req, res) => {
  const isbn = req.body.isbn.trim();
  const title = req.body.title.trim();
  const rating = req.body.rating.trim();
  const notes = req.body.notes.trim();
  const date = new Date(req.body.date_read);
  const url = img_URL + isbn + "-M.jpg";
  try {
    await db.query(
      "insert into book (isbn,title,rating,notes,date_read,email,cover_url) values ($1,$2,$3,$4,$5,$6,$7)",
      [isbn, title, rating, notes, date, req.session.email, url]
    );
    const result = await db.query(
      "select * from book where email=$1 order by rating desc",
      [req.session.email]
    );
    books = result.rows;
    res.render("index.ejs", { books: books, email: req.session.email });
  } catch (error) {
    res.render("error.ejs", {
      err: error,
      msg: "book already added",
    });
  }
});
app.listen(port, () => {
  console.log(`Listening to port:${port}`);
});
