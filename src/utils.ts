export const safeParseFloat = (value: any, defaultValue: number) => {
  if (typeof value === 'number') {
    return value;
  } else if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  } else {
    return defaultValue;
  }
};

export const safeParseInt = (value: any, defaultValue: number) => {
  if (typeof value === 'number') {
    return value;
  } else if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  } else {
    return defaultValue;
  }
};
