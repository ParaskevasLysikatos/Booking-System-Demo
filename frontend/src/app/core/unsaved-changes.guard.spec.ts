import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';

import { HasUnsavedChanges, unsavedChangesGuard } from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  function run(dirty: boolean, answer: boolean | undefined) {
    TestBed.configureTestingModule({});
    const open = vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({ afterClosed: () => of(answer) } as never);
    const component: HasUnsavedChanges = { hasUnsavedChanges: () => dirty };
    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot),
    );
    return { result, open };
  }

  it('lets you leave a clean form without asking', () => {
    const { result, open } = run(false, undefined);
    expect(result).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('asks when there are unsaved changes: Discard -> leave, Keep editing / Esc -> stay', async () => {
    expect(await firstValueFrom(run(true, true).result as Observable<boolean>)).toBe(true);
    TestBed.resetTestingModule();
    expect(await firstValueFrom(run(true, false).result as Observable<boolean>)).toBe(false);
    TestBed.resetTestingModule();
    expect(await firstValueFrom(run(true, undefined).result as Observable<boolean>)).toBe(false);
  });
});
