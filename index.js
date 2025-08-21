import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import pg from "pg";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import methodOverride from "method-override";

dotenv.config();
const app = express();
const port = 3000;
const img_URL = "https://covers.openlibrary.org/b/isbn/";

const saltRounds = 10;
let books = [];

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));

db.connect().catch((err) => {
  console.error("database error");
});

app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect("/index");
  } else {
    res.render("login.ejs");
  }
});

app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.get("/new", (req, res) => {
  res.render("new.ejs");
});

app.get("/index", async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      const result = await db.query("select * from books where email=$1", [
        req.user.email,
      ]);
      books = result.rows;
      res.render("index.ejs", { books: books, email: req.user.email });
    } catch (err) {
      res.render("error.ejs", {
        msg: err,
      });
    }
  } else {
    res.redirect("/");
  }
});

app.get("/book/:isbn", async (req, res) => {
  if (req.isAuthenticated()) {
    const isbn = req.params.isbn;
    const result = await db.query(
      "select * from books where isbn=$1 and email=$2",
      [isbn, req.user.email]
    );
    const book = result.rows[0];
    res.render("book.ejs", { book: book });
  } else {
    res.redirect("/");
  }
});
app.delete("/delete/:isbn", async (req, res) => {
  try {
    if (req.isAuthenticated()) {
      const isbn = req.params.isbn;
      const result = await db.query(
        "delete from books where isbn=$1 and email =$2",
        [isbn, req.user.email]
      );
    }
    res.redirect("/");
  } catch (error) {
    res.render("error.ejs", { err: error, msg: "Cant delete Book" });
  }
});
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    } else {
      res.redirect("/");
    }
  });
});

app.post("/signup", async (req, res) => {
  const email = req.body.email;
  const password = req.body.password;
  try {
    const result = await db.query("select * from users where email=$1", [
      email,
    ]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (user.provider == "local") {
        res.render("error.ejs", { msg: "User already exist try loggin in" });
      } else {
        res.render("error.ejs", {
          msg: "Email linked with Google, Try loggin in with Google",
        });
      }
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "insert into users (email,password) values ($1,$2) returning *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            res.redirect("/index");
          });
        }
      });
    }
  } catch (error) {
    res.render("error.ejs", { err: error });
  }
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
      "insert into books (isbn,title,rating,notes,date_read,email,cover_url) values ($1,$2,$3,$4,$5,$6,$7)",
      [isbn, title, rating, notes, date, req.user.email, url]
    );
    res.redirect("/index");
  } catch (error) {
    res.render("error.ejs", {
      err: error,
      msg: "book already added",
    });
  }
});

passport.use(
  "local",
  new Strategy({ usernameField: "email" }, async function verify(
    email,
    password,
    cb
  ) {
    try {
      const result = await db.query("select * from users where email=$1", [
        email,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedPassword = user.password;
        if (storedPassword == null) {
          cb("User resgistered with Google\nTry logging in with Google");
        }
        bcrypt.compare(password, storedPassword, (err, valid) => {
          if (err) {
            console.log("Error comparing passwords");
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/index", // Must match Google Cloud config exactly
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        const email = profile.emails && profile.emails[0].value;
        if (!email) {
          return cb(new Error("No email found in Google profile"));
        }

        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          email,
        ]);

        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (provider, email) VALUES ($1, $2) RETURNING *",
            ["google", email]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/index",
  passport.authenticate("google", {
    successRedirect: "/index",
    failureRedirect: "/",
  })
);

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/index",
    failureRedirect: "/",
  })
);

app.post("/updatenotes", async (req, res) => {
  if (req.isAuthenticated()) {
    const isbn = req.body.isbn;
    const notes = req.body.notes;
    try {
      await db.query("update books set notes =$1 where isbn=$2 and email=$3", [
        notes,
        isbn,
        req.user.email,
      ]);
      res.redirect(`/book/${isbn}`);
    } catch (err) {
      res.render("error.ejs", { msg: err });
    }
  } else {
    res.redirect("/");
  }
});
passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, () => {
  console.log(`Listening to port:${port}`);
});
