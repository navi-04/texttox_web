/** An error that is safe to show to the user, with the HTTP status to answer with. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
