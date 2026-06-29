import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FollowsService } from './follows.service';

@ApiTags('Follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}
}
