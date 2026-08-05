import React, { createContext, useContext, useState, ReactNode } from 'react';
import { colors } from './colors';

export interface ThemeContextType {
  colors: typeof colors;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

const defaultTheme: ThemeContextType = {
  colors,
  isDarkMode: true,
  toggleTheme: () => {},
};

export const ThemeContext = createContext<ThemeContextType>(defaultTheme);

export const useTheme = () => useContext(ThemeContext);

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState(true);

  const toggleTheme = () => {
    setIsDarkMode(prev => !prev);
  };

  const value = {
    colors,
    isDarkMode,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
