type LoginRequest = {
  email: string;
  password: string;
};

export const login = async ({ email, password }: LoginRequest) => {
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
      },
    };
  }

  throw new Error("Invalid email or password");
};