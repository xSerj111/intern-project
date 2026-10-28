export interface IOAuthPayload {
  email: string;
  sub: string;
}

export interface IOAuthService {
  verifyIdToken(token: string): Promise<IOAuthPayload>;
}
