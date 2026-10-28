import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../common/auth/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProfileSummaryResponseDto } from './dto/profile-summary-response.dto';
import { ProfileSummaryService } from './profile-summary.service';

/**
 * Shares the `profiles` prefix. `by-user/:userId` has two segments, so it can
 * never be shadowed by `ProfilesController`'s one-segment `GET /profiles/:id`.
 */
@ApiTags('Profiles')
@Controller('profiles')
export class ProfileSummaryController {
  constructor(private readonly summaries: ProfileSummaryService) {}

  @ApiOperation({
    summary: 'Profile with follower, following and post counts by auth user id',
  })
  @ApiOkResponse({ type: ProfileSummaryResponseDto })
  @ApiBadRequestResponse({ description: 'userId is not a UUID' })
  @ApiNotFoundResponse({ description: 'User has no profile' })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @Get('by-user/:userId')
  async getByUser(
    @CurrentUser('sub') viewerId: string | undefined,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<ProfileSummaryResponseDto> {
    const { profile, stats } = await this.summaries.getSummary(
      userId,
      viewerId,
    );
    return new ProfileSummaryResponseDto(profile, stats);
  }
}
