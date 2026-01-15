const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Node Mongo Test API",
      version: "1.0.0",
      description: "Simple test API with Node.js, MongoDB & Swagger"
    },
    servers: [
      {
        // url: "http://13.235.116.239:3000"  without nginx
        url: "http://13.235.116.239"
      }
    ]
  },
  apis: ["./routes/*.js"]
};

module.exports = swaggerJSDoc(options);
