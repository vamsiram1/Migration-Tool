import {
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
} from "@mui/material";
import { useState } from "react";

export default function DatabaseCard({
  title,
  connection,
  setConnection,
  onTest,
}) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    setConnection({
      ...connection,
      [event.target.name]: event.target.value,
    });
  };

  const handleTest = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await onTest(connection);

      setResult({
        success: true,
        message: response.data.message,
      });
    } catch (error) {
      setResult({
        success: false,
        message:
          error.response?.data?.detail ||
          error.message ||
          "Connection Failed",
      });
    }

    setLoading(false);
  };

  return (
    <Card elevation={3}>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          {title}
        </Typography>

        <Stack spacing={2}>
          <TextField
            label="Host"
            name="host"
            value={connection.host}
            onChange={handleChange}
            fullWidth
          />

          <TextField
            label="Port"
            name="port"
            value={connection.port}
            onChange={handleChange}
            fullWidth
          />

          <TextField
            label="Database"
            name="database"
            value={connection.database}
            onChange={handleChange}
            fullWidth
          />

          <TextField
            label="Username"
            name="username"
            value={connection.username}
            onChange={handleChange}
            fullWidth
          />

          <TextField
            label="Password"
            name="password"
            type="password"
            value={connection.password}
            onChange={handleChange}
            fullWidth
          />

          <Button
            variant="contained"
            onClick={handleTest}
            disabled={loading}
          >
            {loading ? "Testing..." : "Test Connection"}
          </Button>

          {result && (
            <Alert severity={result.success ? "success" : "error"}>
              {result.message}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}