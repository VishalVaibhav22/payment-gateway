const { z } = require("zod");

const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters long"),

    email: z
      .string()
      .trim()
      .email("Please provide a valid email address"),

    password: z
      .string()
      .min(8, "Password must be at least 8 characters long"),

    role: z
      .enum(["PAYER", "MERCHANT"])
      .default("PAYER"),

    businessName: z
      .string()
      .trim()
      .min(2, "Business name must be at least 2 characters long")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "MERCHANT" && !data.businessName) {
      ctx.addIssue({
        code: "custom",
        path: ["businessName"],
        message: "Business name is required for merchants",
      });
    }
  });

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Please provide a valid email address"),

  password: z
    .string()
    .min(1, "Password is required"),
});

module.exports = {
  registerSchema,
  loginSchema,
};