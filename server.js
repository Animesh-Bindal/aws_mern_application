const express = require("express");
const mongoose = require("mongoose");
const swaggerUI = require("swagger-ui-express");

const swaggerSpec = require("./swagger");
const userRoutes = require("./routes/userRoutes");

const app = express();
app.use(express.json());

// MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/testdb")
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

// Routes
app.use("/api", userRoutes);

// Swagger
app.use("/api-docs", swaggerUI.serve, swaggerUI.setup(swaggerSpec));

// Test route
app.get("/", (req, res) => {
  res.send("Node Mongo Test App Running");
});

const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
