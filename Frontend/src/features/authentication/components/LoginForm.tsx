import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, TextField, Alert } from "@mui/material";
import { useForm } from "react-hook-form";

import { login } from "@/features/authentication/services/authservice";

type LoginFormData = {
  email: string;
  password: string;
};

export default function LoginForm() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setError(null);
      setIsLoading(true);
      const response = await login(data);

      console.log(response);
      // Store user data in localStorage
      localStorage.setItem("user", JSON.stringify(response.user));
      // Navigate to dashboard on successful login
      navigate("/dashboard");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Login failed";
      setError(errorMessage);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TextField
        fullWidth
        label="Email"
        margin="normal"
        type="email"
        {...register("email", { required: "Email is required" })}
        error={!!errors.email}
        helperText={errors.email?.message}
      />

      <TextField
        fullWidth
        type="password"
        label="Password"
        margin="normal"
        {...register("password", { required: "Password is required" })}
        error={!!errors.password}
        helperText={errors.password?.message}
      />

      <Button
        fullWidth
        variant="contained"
        type="submit"
        disabled={isLoading}
        sx={{
          mt: 1.5,
          py: 1,
          bgcolor: "#2A276E",
          "&:hover": {
            bgcolor: "#201F59"
          }
        }}
      >
        {isLoading ? "Logging in..." : "Login"}
      </Button>
    </form>
  );
}
