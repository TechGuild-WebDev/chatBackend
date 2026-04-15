const errorHandler = (err, req, res, next) => {
   console.error("ERR:", err.stack || err); 
  const isPrismaError =
    err.name?.startsWith("Prisma") || err.message?.includes("prisma");

  const statusCode = err.statusCode || 500;
  const safeMessage = isPrismaError
    ? "Something went wrong. Please try again later."
    : err.message || "Internal Server Error";

  const errors = err.errors || [];

  res.status(statusCode).json({
    success: false,
    message: err.message,
    errors: process.env.NODE_ENV === "development" ? errors : [],
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

export default errorHandler;
