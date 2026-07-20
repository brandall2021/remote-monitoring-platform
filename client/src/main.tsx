import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
import App from "./App";
import "./index.css";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#22C55E",
      light: "#4ADE80",
      dark: "#16A34A",
      contrastText: "#020617",
    },
    secondary: {
      main: "#3B82F6",
      light: "#60A5FA",
      dark: "#2563EB",
      contrastText: "#FFFFFF",
    },
    error: {
      main: "#EF4444",
      light: "#F87171",
      dark: "#DC2626",
    },
    warning: {
      main: "#F59E0B",
      light: "#FBBF24",
      dark: "#D97706",
    },
    success: {
      main: "#22C55E",
      light: "#4ADE80",
      dark: "#16A34A",
    },
    background: {
      default: "#020617",
      paper: "#0F172A",
    },
    text: {
      primary: "#F8FAFC",
      secondary: "#94A3B8",
      disabled: "#475569",
    },
    divider: "#1E293B",
  },
  typography: {
    fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    h1: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
    h3: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 600,
      letterSpacing: "-0.01em",
    },
    h4: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 600,
    },
    h5: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 500,
    },
    h6: {
      fontFamily: '"Geist", sans-serif',
      fontWeight: 500,
    },
    subtitle1: {
      fontWeight: 500,
    },
    body1: {
      lineHeight: 1.6,
    },
    button: {
      fontWeight: 500,
      textTransform: "none",
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          padding: "8px 20px",
          fontWeight: 500,
          textTransform: "none",
          boxShadow: "none",
          "&:hover": {
            boxShadow: "none",
          },
        },
        contained: {
          "&:hover": {
            transform: "translateY(-1px)",
            transition: "transform 0.15s ease",
          },
          "&:active": {
            transform: "translateY(0)",
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: "1px solid #1E293B",
          backgroundColor: "#0F172A",
          backgroundImage: "none",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 10,
            backgroundColor: "#1E293B",
            "& fieldset": {
              borderColor: "#334155",
            },
            "&:hover fieldset": {
              borderColor: "#475569",
            },
            "&.Mui-focused fieldset": {
              borderColor: "#22C55E",
            },
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          border: "1px solid #1E293B",
          backgroundColor: "#0F172A",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: "1px solid #1E293B",
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            fontWeight: 600,
            color: "#94A3B8",
            textTransform: "uppercase",
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
          },
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
