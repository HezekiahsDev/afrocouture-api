import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SendMessageDto {
  /** May be empty when an image is attached; the service enforces "text or image". */
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Messages can be at most 2000 characters.' })
  content?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Attachments must be https links.' })
  attachmentUrl?: string;
}
