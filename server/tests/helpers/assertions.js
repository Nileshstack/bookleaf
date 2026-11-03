/** Every error from the API must have this exact envelope. */
export const expectError = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    success: false,
    error: {
      code,
      message: expect.any(String),
      details: expect.any(Array),
      requestId: expect.any(String),
    },
  });
};
