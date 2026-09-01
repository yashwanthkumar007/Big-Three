type LoginRequest = {
  email: string;
  password: string;
};

export const login = async ({ email, password }: LoginRequest) => {
  // Tenant Admin account — has an Admin features gear icon in the navbar.
  if (
    email === "admin@example.com" &&
    password === "Password@123"
  ) {
    return {
      accessToken: "mock-jwt-token",
      user: {
        id: 1,
        name: "Administrator",
        email,
        accountType: "Tenant admin",
      },
    };
  }

  // Regular User account — can only perform inspections; no Admin gear icon.
  if (
    email === "user@example.com" &&
    password === "User@123"
  ) {
    return {
      accessToken: "mock-user-jwt-token",
      user: {
        id: 2,
        name: "Standard User",
        email,
        accountType: "user",
      },
    };
  }

  throw new Error("Invalid email or password");
};