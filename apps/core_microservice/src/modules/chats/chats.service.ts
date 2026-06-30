import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Message } from './domain/entities/message.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ChatsService {
  constructor(
    // Old pattern for now
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>
  ) {}

  async sendMessage(authorId: string, chatId: string, content: string): Promise<Message> {
    const newMessage = this.messageRepository.create({
      authorId,
      chatId,
      content,
    });

    return this.messageRepository.save(newMessage);
  }
}
