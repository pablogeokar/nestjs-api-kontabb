import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class PrepararRecuperacaoPortalDto {
  @IsUUID('4')
  clienteId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(/^\d{6}[A-Z0-9]{12}\d{26}$/, { each: true })
  chaves: string[];
}

export class ImportarRecuperacaoPortalDto {
  @IsUUID('4')
  clienteId: string;

  @Matches(/^\d{6}[A-Z0-9]{12}\d{26}$/)
  chave: string;
}
