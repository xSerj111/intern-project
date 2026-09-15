import { JwtPayload } from '../../domain/interfaces/jwt.service.interface';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
