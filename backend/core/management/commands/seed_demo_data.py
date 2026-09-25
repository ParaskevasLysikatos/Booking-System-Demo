import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from faker import Faker

from bookings.models import Booking
from listings.models import Property, PropertyImage
from reviews.models import Review

DEMO_GUEST_PASSWORD = "DemoPass123!"
DEMO_ADMIN_USERNAME = "admin_demo"
DEMO_ADMIN_EMAIL = "admin_demo@example.com"
DEMO_ADMIN_PASSWORD = "AdminPass123!"

# Greek-themed locations, since this demo is explicitly set in Greece rather
# than Faker's default en_US locale.
LOCATIONS = [
    "Thessaloniki, Greece",
    "Athens, Greece",
    "Chania, Greece",
    "Heraklion, Greece",
    "Rhodes, Greece",
    "Santorini, Greece",
    "Mykonos, Greece",
    "Nafplio, Greece",
    "Ioannina, Greece",
    "Kalamata, Greece",
    "Volos, Greece",
    "Corfu, Greece",
]

ADJECTIVES = [
    "Cozy", "Sunny", "Modern", "Charming", "Spacious", "Elegant",
    "Rustic", "Breezy", "Stylish", "Quiet", "Bright", "Seaside",
]

NOUNS = [
    "Studio", "Apartment", "Loft", "Villa", "Cottage", "Suite",
    "Retreat", "Penthouse", "House", "Room",
]

AMENITIES_POOL = [
    "wifi", "parking", "pool", "air_conditioning", "kitchen", "tv",
    "washer", "heating", "pets_allowed", "balcony", "sea_view",
    "elevator", "gym",
]

# Weighted rating distribution (skewed positive, like a real demo dataset).
RATING_WEIGHTS = {5: 45, 4: 30, 3: 15, 2: 7, 1: 3}

COMMENTS_BY_RATING = {
    5: [
        "Absolutely wonderful stay, would book again in a heartbeat!",
        "Exceeded every expectation - spotless, comfortable, and great location.",
        "Host was fantastic and the place looked exactly like the photos.",
    ],
    4: [
        "Really enjoyed our stay, just a couple of minor things could improve.",
        "Great value for the price, would recommend to friends.",
        "Comfortable and well located, minor noise from the street at night.",
    ],
    3: [
        "It was fine - nothing special, but did the job for a short stay.",
        "Decent place, though a bit smaller than it looked in the pictures.",
    ],
    2: [
        "Had some issues with cleanliness that weren't addressed quickly.",
        "Location was inconvenient and check-in was more complicated than expected.",
    ],
    1: [
        "Would not stay here again, the listing didn't match the description.",
    ],
}


class Command(BaseCommand):
    help = (
        "Populate the database with realistic demo data (properties, images, "
        "guest users, bookings, and reviews) using Faker, so the app doesn't "
        "start out empty. Safe to re-run; use --clear to wipe previously "
        "seeded demo data first."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help=(
                "Delete previously seeded demo data first (reviews, bookings, "
                "property images, properties, and demo guest users - real/admin "
                "accounts are never touched)."
            ),
        )
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help=(
                "Do nothing if any property already exists. Used by the Render "
                "build (build.sh) so only the very first deploy seeds, and later "
                "deploys never wipe or duplicate data."
            ),
        )
        parser.add_argument(
            "--properties",
            type=int,
            default=14,
            help="Number of properties to create (default: 14).",
        )
        parser.add_argument(
            "--guests",
            type=int,
            default=10,
            help="Number of guest users to create (default: 10).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Random seed, for reproducible output (default: not fixed).",
        )

    def handle(self, *args, **options):
        if options["if_empty"] and Property.objects.exists():
            self.stdout.write("Properties already exist - skipping the demo seed (--if-empty).")
            return

        if options["seed"] is not None:
            random.seed(options["seed"])
            Faker.seed(options["seed"])

        fake = Faker()

        with transaction.atomic():
            if options["clear"]:
                self._clear_demo_data()

            admin_created = self._create_admin()
            guests = self._create_guests(fake, options["guests"])
            properties = self._create_properties(fake, options["properties"])
            self._create_images(properties)
            self._create_bookings(properties, guests)
            self._create_reviews(fake, properties)

        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded {len(properties)} properties and {len(guests)} guests."
        ))
        if admin_created:
            self.stdout.write(
                f"Demo admin login: {DEMO_ADMIN_EMAIL} / {DEMO_ADMIN_PASSWORD} "
                f"(app/API, by email) - or username {DEMO_ADMIN_USERNAME} for /admin/"
            )
        else:
            self.stdout.write(
                f"Demo admin '{DEMO_ADMIN_USERNAME}' already existed - left untouched."
            )
        self.stdout.write(
            f"Demo guest login password (all guest_* accounts, log in with "
            f"their @example.com email): {DEMO_GUEST_PASSWORD}"
        )

    # -- clearing -----------------------------------------------------

    def _clear_demo_data(self):
        """Delete order matters: Booking/Review use on_delete=PROTECT on
        `property`, so they must go before Property. Demo guest users are
        identified by the username/email pattern this command itself uses,
        so real/admin accounts are never touched."""
        self.stdout.write("Clearing previously seeded demo data...")
        Review.objects.all().delete()
        Booking.objects.all().delete()
        PropertyImage.objects.all().delete()
        Property.objects.all().delete()
        User.objects.filter(
            username__startswith="guest_", email__endswith="@example.com"
        ).delete()
        User.objects.filter(username=DEMO_ADMIN_USERNAME).delete()

    # -- admin ------------------------------------------------------------

    def _create_admin(self):
        """One fixed-credential superuser for testing admin-only flows.
        Superuser/staff status makes the existing post_save signal
        (accounts/signals.py) set Profile.role='admin' automatically - the
        same path a real admin account goes through, so this exercises the
        actual rule rather than a seed-only shortcut. Idempotent: if it
        already exists (e.g. re-running the command without --clear), it's
        left alone rather than raising an IntegrityError on the duplicate
        username."""
        if User.objects.filter(username=DEMO_ADMIN_USERNAME).exists():
            return False
        User.objects.create_superuser(
            DEMO_ADMIN_USERNAME, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD
        )
        return True

    # -- guests ---------------------------------------------------------

    def _create_guests(self, fake, count):
        guests = []
        for i in range(count):
            username = f"guest_{i}_{fake.unique.user_name()}"
            email = f"{username}@example.com"
            user = User(
                username=username,
                email=email,
                first_name=fake.first_name(),
                last_name=fake.last_name(),
            )
            user.set_password(DEMO_GUEST_PASSWORD)
            user.save()
            guests.append(user)
        return guests

    # -- properties -------------------------------------------------------

    def _create_properties(self, fake, count):
        properties = []
        for _ in range(count):
            location = random.choice(LOCATIONS)
            city = location.split(",")[0]
            title = f"{random.choice(ADJECTIVES)} {random.choice(NOUNS)} in {city}"
            amenities = random.sample(
                AMENITIES_POOL, k=random.randint(3, len(AMENITIES_POOL))
            )
            prop = Property.objects.create(
                title=title,
                description=fake.paragraph(nb_sentences=5),
                location=location,
                price_per_night=Decimal(random.randint(25, 250)),
                capacity=random.randint(1, 8),
                amenities=amenities,
                is_active=random.random() < 0.9,
            )
            properties.append(prop)
        return properties

    # -- images -----------------------------------------------------------

    def _create_images(self, properties):
        for prop in properties:
            image_count = random.randint(2, 5)
            for idx in range(image_count):
                PropertyImage.objects.create(
                    property=prop,
                    image=f"https://picsum.photos/seed/{prop.pk}-{idx}/800/600",
                    is_cover=(idx == 0),
                )

    # -- bookings -----------------------------------------------------------

    def _create_bookings(self, properties, guests):
        today = timezone.localdate()
        for prop in properties:
            for _ in range(random.randint(0, 5)):
                start_offset = random.randint(-60, 300)
                check_in = today + timedelta(days=start_offset)
                check_out = check_in + timedelta(days=random.randint(1, 14))

                # Reuse the overlap-detection helper built for TICKET-008 so
                # seeded bookings never conflict for the same property.
                if Property.objects.filter(pk=prop.pk).exists() and Booking.objects.overlapping(
                    prop, check_in, check_out
                ).exists():
                    continue

                nights = (check_out - check_in).days
                total_price = prop.price_per_night * nights

                if check_out <= today:
                    # Past stay: mostly confirmed, a few cancelled.
                    status = random.choices(
                        [Booking.Status.CONFIRMED, Booking.Status.CANCELLED],
                        weights=[85, 15],
                    )[0]
                else:
                    # Upcoming stay: a mix of pending/confirmed/cancelled.
                    status = random.choices(
                        [Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.CANCELLED],
                        weights=[30, 55, 15],
                    )[0]

                Booking.objects.create(
                    property=prop,
                    guest=random.choice(guests),
                    check_in=check_in,
                    check_out=check_out,
                    guests=random.randint(1, prop.capacity),
                    total_price=total_price,
                    status=status,
                )

    # -- reviews -----------------------------------------------------------

    def _create_reviews(self, fake, properties):
        today = timezone.localdate()
        # Only guests with a genuine past, non-cancelled stay can review -
        # mirrors the real-world rule this app will eventually enforce.
        past_bookings = Booking.objects.filter(
            property__in=properties,
            check_out__lte=today,
        ).exclude(status=Booking.Status.CANCELLED)

        for booking in past_bookings:
            rating = random.choices(
                list(RATING_WEIGHTS.keys()), weights=list(RATING_WEIGHTS.values())
            )[0]
            comment = random.choice(COMMENTS_BY_RATING[rating])
            # get_or_create respects unique_review_per_guest_per_property:
            # a guest with several past bookings for the same property only
            # ever gets one seeded review for it.
            Review.objects.get_or_create(
                property=booking.property,
                guest=booking.guest,
                defaults={"rating": rating, "comment": comment},
            )
