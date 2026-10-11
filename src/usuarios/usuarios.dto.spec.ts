import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUsuarioDto, UpdateUsuarioDto } from './usuarios.dto';

describe('Usuarios DTOs - validação de role', () => {
  it('CreateUsuarioDto rejeita role fora da whitelist', async () => {
    const dto = plainToInstance(CreateUsuarioDto, {
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'secret123',
      role: 'SUPERADMIN',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('CreateUsuarioDto aceita role válida', async () => {
    const dto = plainToInstance(CreateUsuarioDto, {
      name: 'Fulano',
      email: 'fulano@example.com',
      password: 'secret123',
      role: 'ADMIN',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('UpdateUsuarioDto rejeita role fora da whitelist', async () => {
    const dto = plainToInstance(UpdateUsuarioDto, { role: 'HACKER' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('UpdateUsuarioDto aceita payload sem role (parcial)', async () => {
    const dto = plainToInstance(UpdateUsuarioDto, { name: 'Novo Nome' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
