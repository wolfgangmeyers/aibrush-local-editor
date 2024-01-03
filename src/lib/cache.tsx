import { useEffect, useState } from "react";

export function useCache<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => {
      const cachedValue = localStorage.getItem(key);
      return cachedValue !== null ? JSON.parse(cachedValue) : initialValue;
    });
  
    useEffect(() => {
      localStorage.setItem(key, JSON.stringify(value));
    }, [key, value]);
  
    return [value, setValue];
  }
  