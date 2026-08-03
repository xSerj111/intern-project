import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Wstrzykujemy ConfigService, aby pobrać współdzielony sekret JWT
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

    try {
      // Pobieramy ten sam klucz, którego używa auth_microservice
      const secret =
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        process.env.JWT_ACCESS_SECRET;

      if (!secret) {
        throw new InternalServerErrorException(
          'JWT access secret is not configured on the server',
        );
      }

      // Weryfikacja sygnatury i dekodowanie payloadu
      const payload = jwt.verify(token, secret);

      // Magia: Przypinamy zweryfikowany payload do obiektu żądania (req)
      // Dzięki temu będzie on dostępny dalej w kontrolerach
      request['user'] = payload;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      // Jeśli token jest nieważny, wygasł (TokenExpiredError) lub zmanipulowany, odrzucamy żądanie
      throw new UnauthorizedException(
        'Invalid or expired authentication token',
      );
    }

    return true; // Pozwalamy na przejście do kontrolera
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    // Rozdzielamy nagłówek "Authorization: Bearer <token>"
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
