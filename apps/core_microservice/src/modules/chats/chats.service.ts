import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerKey, type Logger } from '@repo/shared';
import { Message } from './domain/entities/message.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ChatsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    // Old pattern for now
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async sendMessage(
    authorId: string,
    chatId: string,
    content: string,
  ): Promise<Message> {
    const newMessage = this.messageRepository.create({
      authorId,
      chatId,
      content,
    });

    const savedMessage = await this.messageRepository.save(newMessage);
    this.logger.debug('Message sent', {
      props: { messageId: savedMessage.id },
    });
    return savedMessage;
  }
}
